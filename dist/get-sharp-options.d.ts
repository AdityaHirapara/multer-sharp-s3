import { SharpOptions } from './types';
declare function getSharpOptions(options: SharpOptions): {
    resize: import("./types").ResizeOption;
    background: string | void | import("sharp").RGBA;
    crop: string | number | void;
    embed: boolean;
    max: boolean;
    min: boolean;
    toFormat: string | void | import("./types").Format;
    extract: void | import("sharp").Region;
    trim: number | void;
    flatten: boolean;
    extend: number | void | import("sharp").ExtendOptions;
    negate: boolean;
    rotate: boolean;
    flip: boolean;
    flop: boolean;
    blur: number | void;
    sharpen: void | import("./types").Sharpen;
    gamma: number | void;
    grayscale: boolean;
    greyscale: boolean;
    normalize: boolean;
    normalise: boolean;
    convolve: void | import("sharp").Kernel;
    threshold: number | void | import("./types").Threshold;
    toColourspace: string | void;
    toColorspace: string | void;
    ignoreAspectRatio: boolean;
    withMetadata: void | import("sharp").Metadata;
    withoutEnlargement: boolean;
};
export default getSharpOptions;
