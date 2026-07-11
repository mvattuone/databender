export type ChainMode = 'series' | 'parallel';

export type DatabenderConfig = {
    chainMode?: ChainMode;
    [key: string]: unknown;
};

export interface EffectFactoryArguments<TConfig extends object = DatabenderConfig> {
    context: OfflineAudioContext;
    source: AudioBufferSourceNode;
    config: TConfig;
}

export interface EffectNodePair {
    input: AudioNode;
    output: AudioNode;
}

export type EffectNode = AudioNode | EffectNodePair;
export type EffectFactoryValue =
    | EffectNode
    | null
    | undefined
    | ReadonlyArray<EffectNode | null | undefined | Promise<EffectNode | null | undefined>>;
export type EffectFactoryResult = EffectFactoryValue | Promise<EffectFactoryValue>;

export type EffectFactory<TConfig extends object = DatabenderConfig> = (
    args: EffectFactoryArguments<TConfig>
) => EffectFactoryResult;

export type SourceParam<TConfig extends object = DatabenderConfig> = (
    args: EffectFactoryArguments<TConfig>
) => void | Promise<void>;

export interface DatabenderOptions<TConfig extends object = DatabenderConfig> {
    config?: TConfig;
    effectsChain?: EffectFactory<TConfig> | ReadonlyArray<EffectFactory<TConfig>>;
    chainMode?: ChainMode;
    sourceParams?: SourceParam<TConfig> | ReadonlyArray<SourceParam<TConfig>>;
    audioCtx?: BaseAudioContext;
}

export type DatabenderImageSource = ImageData | HTMLImageElement | HTMLVideoElement;
export type DatabenderCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export default class Databender<TConfig extends object = DatabenderConfig> {
    constructor(options?: DatabenderOptions<TConfig>);

    audioCtx: BaseAudioContext;
    channels: number;
    config: TConfig;
    configKeys: string[];
    previousConfig: TConfig;
    effectsChain: EffectFactory<TConfig>[] | null;
    sourceParams: SourceParam<TConfig>[] | null;
    chainMode: ChainMode;
    maxConcurrentRenders: number;
    activeRenderCount: number;
    renderQueue: Array<{ resolve: () => void }>;
    imageData?: ImageData;

    convert(image: DatabenderImageSource): Promise<AudioBuffer>;
    configHasChanged(): boolean;
    updateConfig(effect: string, param: string | undefined, value: unknown): void;
    render(buffer: AudioBuffer, bypass?: boolean): Promise<AudioBuffer>;
    draw(
        buffer: AudioBuffer,
        context: DatabenderCanvasContext,
        sourceX?: number,
        sourceY?: number,
        x?: number,
        y?: number,
        sourceWidth?: number,
        sourceHeight?: number,
        targetWidth?: number,
        targetHeight?: number
    ): void;
    bend(
        data: DatabenderImageSource,
        context: DatabenderCanvasContext,
        sourceX?: number,
        sourceY?: number,
        x?: number,
        y?: number,
        targetWidth?: number,
        targetHeight?: number
    ): Promise<void>;
}
