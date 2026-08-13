export class SampleService implements IService {
  private inited = false;

  init = async (): PVoid => {
    if (!this.inited) {
      // one-time setup: SDK init, remote config, warm-up requests ...

      this.inited = true;
    }
  };

  // public API used by screens via `useServices()`
  doSomething = async (): PVoid => {};
}

// Remember: add `sample = new SampleService();` to `class Services` in src/services/index.tsx,
// otherwise `init()` never runs.
