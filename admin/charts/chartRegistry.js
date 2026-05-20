export class ChartRegistryManager {
  constructor() {
    this.instances = new Map();
  }

  upsert(canvas, config) {
    if (!canvas || !config || typeof window.Chart !== "function") {
      return null;
    }

    const existing = this.instances.get(canvas.id);
    if (!existing) {
      const instance = new window.Chart(canvas.getContext("2d"), config);
      this.instances.set(canvas.id, instance);
      return instance;
    }

    if (existing.config.type !== config.type) {
      existing.destroy();
      const next = new window.Chart(canvas.getContext("2d"), config);
      this.instances.set(canvas.id, next);
      return next;
    }

    existing.data = config.data;
    existing.options = config.options;
    existing.update("none");
    return existing;
  }

  destroyAll() {
    this.instances.forEach((instance) => instance.destroy());
    this.instances.clear();
  }
}
