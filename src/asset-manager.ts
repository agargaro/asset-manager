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

/**
 * Manually adds a resource to the internal cache.
 * @param path - The unique identifier (usually a URL or file path) of the resource.
 * @param value - The associated value to store.
 */
export function add(path: string, value: unknown): void {
  _resources.set(path, value);
}

/**
 * Retrieves a cached resource by its path.
 * @param path - The unique identifier of the resource.
 * @returns The typed resource if it exists in the cache.
 */
export function get<T>(path: string): T {
  return _resources.get(path) as T;
}

/**
 * Removes one or more resources from the internal cache.
 * @param paths - One or more resource paths to be removed.
 */
export function remove(...paths: string[]): void {
  for (const path of paths) {
    _resources.delete(path);
  }
}

/**
 * Returns a shared loader instance of the specified type.
 * If the loader is not cached yet, it will be instantiated and stored.
 * @param loaderType - The loader constructor.
 * @returns The loader instance.
 */
export function getLoader<T extends Loader>(loaderType: LoaderType<T>): T {
  if (!_loaders.has(loaderType)) {
    _loaders.set(loaderType, new loaderType());
  }
  return _loaders.get(loaderType) as T;
}

/**
 * Removes a previously cached loader instance.
 * @param loaderType - The loader constructor to remove.
 */
export function removeLoader(loaderType: LoaderType): void {
  _loaders.delete(loaderType);
}

/**
 * Sets a global default onProgress callback for future loads.
 * @param onProgress - Callback triggered during loading progress.
 */
export function setOnProgressDefault(onProgress: OnProgressCallback): void {
  _onProgress = onProgress;
}

/**
 * Sets a global default onError callback for future loads.
 * @param onError - Callback triggered when an error occurs.
 */
export function setOnErrorDefault(onError: OnErrorCallback): void {
  _onError = onError;
}

/**
 * Loads a single resource using the specified loader.
 * If the resource is already cached, it returns it immediately.
 * @param loaderType - The loader constructor.
 * @param path - The path to the resource to be loaded.
 * @param onProgress - (Optional) Callback triggered during loading.
 * @param onError - (Optional) Callback triggered on load error.
 * @returns A Promise that resolves with the loaded resource.
 */
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

/**
 * Queues resources to be loaded later via `loadPending`.
 * @param loader - The loader constructor.
 * @param resources - One or more resource paths or configs.
 */
export function preload<L extends Loader>(loader: LoaderType<L>, ...resources: (string | ResourceConfig<L>)[]): void {
  _pending.push({ loader, paths: resources });
}

/**
 * Loads all queued resources previously added via `preload`.
 * Supports global or per-call progress and error callbacks.
 * @param config - Optional config containing callbacks.
 * @returns A Promise that resolves when all resources are loaded.
 */
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
