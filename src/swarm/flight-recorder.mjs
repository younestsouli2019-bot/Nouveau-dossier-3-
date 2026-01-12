export const globalRecorder = {
  events: [],
  record(event) {
    this.events.push({ at: new Date().toISOString(), ...event });
    return true;
  }
};

