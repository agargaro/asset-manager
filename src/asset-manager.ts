import { type Loader } from 'three';

export type LoaderType<L extends Loader = Loader> = new () => L;
export type LoaderResponse<L extends Loader> = Awaited<ReturnType<L['loadAsync']>>;

export type OnLoadCallback<L extends Loader = Loader> = (result: LoaderResponse<L>) => void;
export type OnProgressCallback = (ratio: number) => void;
export type OnErrorCallback = (error: unknown) => void;

export type LoadingConfig = { onProgress?: OnProgressCallback; onError?: OnErrorCallback };
export type Resource<L extends Loader = Loader> = { loader: LoaderType<L>; paths: (string | ResourceConfig<L>)[] };
export type ResourceConfig<L extends Loader = Loader> = { path: string; onLoad: OnLoadCallback<L> };

let _onProgress: OnProgressCallback | null = null;
let _onError: OnErrorCallback | null = null;
const _loaders = new Map<LoaderType, Loader>();
const _resources = new Map<string, unknown>();
const _pending: Resource[] = [];

export function add(path: string, value: unknown): void {
  _resources.set(path, value);
}

export function get<T>(path: string): T {
  return _resources.get(path) as T;
}

export function remove(...paths: string[]): void {
  for (const path of paths) {
    _resources.delete(path);
  }
}

export function getLoader<T extends Loader>(loaderType: LoaderType<T>): T {
  if (!_loaders.has(loaderType)) {
    _loaders.set(loaderType, new loaderType());
  }
  return _loaders.get(loaderType) as T;
}

export function removeLoader(loaderType: LoaderType): void {
  _loaders.delete(loaderType);
}

export function setOnProgressDefault(onProgress: OnProgressCallback): void {
  _onProgress = onProgress;
}

export function setOnErrorDefault(onError: OnErrorCallback): void {
  _onError = onError;
}

export async function load<L extends Loader>(loaderType: LoaderType<L>, path: string, onProgress?: (event: ProgressEvent) => void, onError?: OnErrorCallback): Promise<LoaderResponse<L> | null> {
  return new Promise<LoaderResponse<L> | null>((resolve) => {
    if (_resources.has(path)) return resolve(_resources.get(path) as LoaderResponse<L>);

    _resources.set(path, null);

    getLoader(loaderType).load(path, (result) => {
      _resources.set(path, result);
      resolve(result as LoaderResponse<L>);
    }, onProgress, (e) => {
      _resources.delete(path);
      if (onError) onError(e);
      resolve(null);
    });
  });
}

export function preload<L extends Loader>(loader: LoaderType<L>, ...resources: (string | ResourceConfig<L>)[]): void {
  _pending.push({ loader, paths: resources });
}

export async function loadPending(config: LoadingConfig = {}): Promise<void[]> {
  const promises: Promise<void>[] = [];
  const onProgress = config.onProgress ?? _onProgress;
  const onError = config.onError ?? _onError;
  let total = 0;
  let progress = 0;

  let resource: Resource | undefined;
  while ((resource = _pending.pop())) {
    _load(resource);
  }

  return Promise.all(promises);

  function _load(resource: Resource): void {
    if (resource?.paths) {
      const loader = getLoader(resource.loader);

      for (const res of resource.paths) {
        const path = (res as ResourceConfig).path ?? res as string;
        const onload = (res as ResourceConfig).onLoad;

        if (_resources.has(path)) {
          if (onload) onload(_resources.get(path));
          continue;
        }

        promises.push(_createPromise(loader, path, onload));
        total++;
      }
    }
  }

  function _createPromise(loader: Loader, path: string, onLoad: OnLoadCallback): Promise<void> {
    // TODO we can use onProgressCallback (now undefined) to calculate correct ratio based on bytes size
    _resources.set(path, null);

    return new Promise<void>((resolve) => {
      loader.load(path, (result) => {
        _resources.set(path, result);
        if (onProgress) onProgress(++progress / total);
        if (onLoad) onLoad(result);
        resolve();
      }, undefined, (e) => {
        _resources.delete(path);
        if (onError) onError(e);
        if (onProgress) onProgress(++progress / total);
        resolve();
      });
    });
  }
}
