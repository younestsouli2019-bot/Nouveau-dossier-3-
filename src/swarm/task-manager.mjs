export class TaskManager {
  constructor() {
    this.tasks = [];
  }
  add(task) {
    this.tasks.push({ ...task, addedAt: new Date().toISOString() });
    return this;
  }
  list() {
    return [...this.tasks];
  }
  clear() {
    this.tasks = [];
  }
}

