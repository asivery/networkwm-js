import { readTags, readFrame, FrameHeader, Header } from 'mp3-parser';
import { writeUint32 } from './bytemanip';
import { createEA3Header, NWCodec, NWCodecInfo } from './codecs';
import { InboundTrackMetadata, TrackMetadata } from './databases';
import { readSynchsafeInt32, serialize, createCommonID3Tags, encodeSonyWeirdString } from './id3';
import { getMP3EncryptionKey } from './encryption';

const HIMD_MP3_VAR_VERSION = 0x40;
const HIMD_MP3_VAR_LAYER = 0x20;
const HIMD_MP3_VAR_BITRATE = 0x10;
const HIMD_MP3_VAR_SRATE = 0x08;
const HIMD_MP3_VAR_CHMODE = 0x04;
const HIMD_MP3_VAR_PREEMPH = 0x02;

const MP3_SAMPLE_RATE_TABLE = [
    [11.025, 12, 8],
    [],
    [22.05, 24, 16],
    [44.1, 48, 32],
];
const ONE_CHANNEL_SAMPLES_IN_FRAME = 576;

export function generateMP3CodecField(mp3Data: Uint8Array): { codec: NWCodecInfo, duration: number, frames: number } {
    // Generate flags:
    const view = new DataView(mp3Data.buffer);
    const findRootSection = (type: string) => readTags(view).filter((e: any) => e._section.type === type)[0];

    let frame = findRootSection('frame') as Header<FrameHeader>;
    let mpegVers = 3,
        mpegLayer = 1,
        mpegBitrate = 9,
        mpegSampleRate = 0,
        mpegChMode = 0,
        mpegPreemph = 0,
        flags = 0x80,
        frameCount = 0,
        totalDuration = 0,
        firstTime = true;
    for (;;) {
        ++frameCount;
        let blockMpegVersion = (view.getUint8(frame.header._section.offset + 1) >> 3) & 0x03, //binary(frame.header.mpegAudioVersionBits),
            blockMpegLayer = (view.getUint8(frame.header._section.offset + 1) >> 1) & 0x03, //binary(frame.header.layerDescriptionBits),
            blockMpegBitrate = (view.getUint8(frame.header._section.offset + 2) >> 4) & 0x0f, //binary(frame.header.bitrateBits),
            blockMpegSampleRate = (view.getUint8(frame.header._section.offset + 2) >> 2) & 0x03, //binary(frame.header.samplingRateBits),
            blockMpegChannelMode = (view.getUint8(frame.header._section.offset + 3) >> 6) & 0x03, //binary(frame.header.channelModeBits),
            blockMpegPreemph = view.getUint8(frame.header._section.offset + 3) & 0x03;
        if (firstTime) {
            mpegVers = blockMpegVersion;
            mpegLayer = blockMpegLayer;
            mpegBitrate = blockMpegBitrate;
            mpegSampleRate = blockMpegSampleRate;
            mpegChMode = blockMpegChannelMode;
            mpegPreemph = blockMpegPreemph;
            firstTime = false;
        } else {
            if (blockMpegVersion !== mpegVers) {
                flags |= HIMD_MP3_VAR_VERSION;
                mpegVers = Math.min(mpegVers, blockMpegVersion); /* smaller num -> higher version */
            }
            if (blockMpegLayer !== mpegLayer) {
                flags |= HIMD_MP3_VAR_LAYER;
                mpegLayer = Math.min(mpegLayer, blockMpegLayer); /* smaller num -> higher layer */
            }
            if (blockMpegBitrate !== mpegBitrate) {
                /* TODO: check whether "free-form" streams need special handling */
                flags |= HIMD_MP3_VAR_BITRATE;
                mpegBitrate = Math.max(mpegBitrate, blockMpegBitrate);
            }
            if (blockMpegSampleRate !== mpegSampleRate) {
                flags |= HIMD_MP3_VAR_SRATE;
                /* "1" is highest (48), "0" is medium (44), "2" is lowest (32) */
                if (mpegSampleRate !== 1) {
                    if (blockMpegSampleRate === 1) mpegSampleRate = blockMpegSampleRate;
                    else mpegSampleRate = Math.min(mpegSampleRate, blockMpegSampleRate);
                }
            }
            if (blockMpegChannelMode !== mpegChMode) {
                /* TODO: find out how to choose "maximal" mode */
                flags |= HIMD_MP3_VAR_CHMODE;
            }
            if (blockMpegPreemph !== mpegPreemph) {
                /* TODO: find out how to choose "maximal" preemphasis */
                flags |= HIMD_MP3_VAR_PREEMPH;
            }
        }
        const channelCount = (mpegChMode & 0b10) === 0 ? 2 : 1;
        totalDuration += ONE_CHANNEL_SAMPLES_IN_FRAME * channelCount /  MP3_SAMPLE_RATE_TABLE[blockMpegVersion][blockMpegSampleRate];

        let nextFrameIndex = frame._section.nextFrameIndex!;
        if (!nextFrameIndex) break;
        frame = readFrame(view, nextFrameIndex)!;
        if (frame === null) break;
    }

    const mp3CodecInfo = new Uint8Array(3 + 4 + 4);

    mp3CodecInfo[0] = flags;
    mp3CodecInfo[1] = (mpegVers << 6) | (mpegLayer << 4) | mpegBitrate;
    mp3CodecInfo[2] = (mpegSampleRate << 6) | (mpegChMode << 4) | (mpegPreemph << 2);
    mp3CodecInfo.set(writeUint32(Math.floor(totalDuration)), 3);
    mp3CodecInfo.set(writeUint32(Math.floor(frameCount)), 7);
    return { 
        codec: {
            codecId: NWCodec.MP3, codecInfo: mp3CodecInfo, complete: true
        },
        duration: totalDuration,
        frames: frameCount,
    };
}

export function createMP3OMAFile(index: number, metadata: InboundTrackMetadata, rawFile: Uint8Array, deviceKey: number, codec: NWCodecInfo): Uint8Array {
    // Strip all ID3 tags from the source MP3 file
    let cursor = 0;
    const rawDataView = new DataView(rawFile.buffer);
    const ID3_MAGIC = new TextEncoder().encode("ID3");
    while(ID3_MAGIC.every((e, i) => rawFile[cursor + i] === e)) {
        // We're in an ID3 section
        const length = readSynchsafeInt32(rawDataView, cursor + 6)[0];
        cursor += 10 + length;
    }
    // Cursor points to the start of the first MP3 frame in this file.
    // Create the new and compliant ID3 tag set from metadata
    const rootID3 = serialize({
        version: { major: 3, minor: 0 },
        flags: 0,
        tags: [
            ...createCommonID3Tags(metadata),
            { id: 'TXXX', flags: 0, contents: encodeSonyWeirdString("OMG_FPRCA1", " ")},
            { id: 'TXXX', flags: 0, contents: encodeSonyWeirdString("OMG_FCRCA1", " ")},
            { id: 'TXXX', flags: 0, contents: encodeSonyWeirdString("OMG_TRLDA", "1982/01/01 00:00:00")},
        ],
    });
    const formatHeader = createEA3Header(codec, 0xFFFE, 2);

    const finalFileBuffer = new Uint8Array(rootID3.length + formatHeader.length + rawFile.length - cursor);
    finalFileBuffer.set(rootID3, 0);
    finalFileBuffer.set(formatHeader, rootID3.length);
    const finalDataView = new DataView(finalFileBuffer.buffer);
    const key = getMP3EncryptionKey(deviceKey, index);
    let finalBufferCursor = rootID3.length + formatHeader.length;
    for(; cursor < rawFile.length - 7; cursor += 8, finalBufferCursor += 8) {
        finalDataView.setUint32(finalBufferCursor, rawDataView.getUint32(cursor) ^ key);
        finalDataView.setUint32(finalBufferCursor + 4, rawDataView.getUint32(cursor + 4) ^ key);
    }

    return finalFileBuffer;
}
