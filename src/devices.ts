import type { LAYERS } from "./init-data";

export interface DatabaseParameters {
    initLayers: (keyof typeof LAYERS)[],
}

export interface DeviceDefinition{
    vendorId: number;
    productId: number;
    name: string;
    databaseParameters?: DatabaseParameters;
}

export const DeviceIds: DeviceDefinition[] = [
    { vendorId: 0x054c, productId: 0x01ad, name: 'Sony NW-HD1 / NW-HD2' },
    { vendorId: 0x054c, productId: 0x0210, name: 'Sony NW-HD3' },
    { vendorId: 0x054c, productId: 0x0233, name: 'Sony NW-HD5' },
    {
        vendorId: 0x054c,
        productId: 0x026a,
        name: 'Sony NW-A1000',
        databaseParameters: {
            initLayers: [ 'needs_cid' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x0269,
        name: 'Sony NW-A3000',
        databaseParameters: {
            initLayers: [ 'needs_cid' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x0358,
        name: 'Sony NW-E026F',
        databaseParameters: {
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x03c6,
        name: 'Sony NW-E043',
        databaseParameters: {
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x02E4,
        name: 'Sony NW-S203F',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x01FB,
        name: 'Sony NW-E305',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x027c,
        name: 'Sony NW-A608',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x082e,
        name: 'Sony NWZ-W273S',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x0358,
        name: 'Sony NW-E026f',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x02E3,
        name: 'Sony NW-S703F',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x02ED,
        name: 'Sony NW-A808',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [ 'stick_gtrlst' ],
        }
    },
    {
        vendorId: 0x054c,
        productId: 0x00E8,
        name: 'Sony NW-MS70D',
        databaseParameters: { // Assumed - device untested!!
            initLayers: [],
        }
    }
];

export function findDevice(vid: number, pid: number): DeviceDefinition | null {
    return DeviceIds.find(e => e.vendorId === vid && e.productId === pid) ?? null;
}
