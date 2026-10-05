/** Acquire synchronously; release only after the complete native-backed operation settles. No queue. */
export function createSingleFlight() {
  let occupied = false;
  return {
    get occupied() {
      return occupied;
    },
    async run(operation: () => Promise<void>): Promise<boolean> {
      if (occupied) return false;
      occupied = true;
      try {
        await operation();
        return true;
      } finally {
        occupied = false;
      }
    },
  };
}
