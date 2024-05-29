type Bit = "0" | "1";
declare module 'mp3-parser' {
    declare interface Section{
        type: string;
        offset: number;
        byteLength: number;
        nextFrameIndex?: number;
        sampleLength?: number;
    }
    declare interface ID3Header{
        majorVersion: number;
        minorRevision: number;
        flagsOctet: number;
        unsynchronisationFlag: boolean;
        extendedHeaderFlag: boolean;
        experimentalIndicatorFlag: boolean;
        size: number;
    }
    declare interface XingHeader{
        _section: Section;
        mpegAudioVersionBits: `${Bit}${Bit}`;
        mpegAudioVersion: string;
        layerDescriptionBits: `${Bit}${Bit}`;
        layerDescription: number;
        isProtected: number;
        protectionBit: Bit;
        bitrateBits: `${Bit}${Bit}${Bit}${Bit}`;
        bitrate: number;
        samplingRateBits: `${Bit}${Bit}`;
        samplingRate: number;
        frameIsPaddedBit: Bit;
        frameIsPadded: number;
        framePadding: number;
        privateBit: Bit;
        channelModeBits: `${Bit}${Bit}`;
        channelMode: 'Joint stereo (Stereo)' | 'Stereo' | 'Mono';
    }
    declare interface FrameHeader{
        _section: Section;
        mpegAudioVersionBits: `${Bit}${Bit}`;
        mpegAudioVersion: string;
        layerDescriptionBits: `${Bit}${Bit}`;
        layerDescription: string;
        isProtected: number;
        protectionBit: Bit;
        bitrateBits: `${Bit}${Bit}${Bit}${Bit}`;
        bitrate: number;
        samplingRateBits: `${Bit}${Bit}`;
        samplingRate: number;
        frameIsPaddedBit: Bit;
        frameIsPadded: false;
        framePadding: number;
        privateBit: Bit;
        channelModeBits: `${Bit}${Bit}`;
        channelMode: 'Joint stereo (Stereo)' | 'Stereo' | 'Mono';
    }
    declare interface Header<T>{
        _section: Section;
        header: T;
        identifier?: string;
    }
    declare function readTags(view: DataView, offset?: number): Header<XingHeader | ID3Header | FrameHeader>[];
    declare function readFrame(view: DataView, offset?: number): Header<FrameHeader> | null;
    declare function readFrameHeader(view: DataView, offset?: number): FrameHeader;
};
