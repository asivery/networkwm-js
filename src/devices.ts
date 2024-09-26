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
    { vendorId: 0x054c, productId: 0x0269, name: 'Sony NW-A3000' },
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
    }
];
