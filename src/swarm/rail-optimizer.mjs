export class RailOptimizer {
  optimize(context = {}) {
    return {
      ok: true,
      route: "DIRECT_TO_OWNER",
      context
    };
  }
}

