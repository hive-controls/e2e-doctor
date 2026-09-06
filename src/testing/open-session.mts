/**
 * Open a driver session with the resources already standing behind it.
 *
 * `driver.open()` launches a browser, and a browser that is not installed throws. When
 * a static app server is already listening at that point, a bare
 * `const session = await driver.open()` above the `try` leaks it: the listening socket
 * keeps the event loop alive, so the process never exits and the runner that spawned it
 * waits forever instead of reporting the launch failure. Closing what is already open
 * before rethrowing turns that silent hang into the error the caller can read.
 */
export interface Closable {
  close(): Promise<unknown>;
}

export interface OpensSession<T> {
  open(): Promise<T>;
}

export async function openSessionOrClose<T>(
  driver: OpensSession<T>,
  ...alreadyOpen: Closable[]
): Promise<T> {
  try {
    return await driver.open();
  } catch (error) {
    for (const resource of alreadyOpen) {
      await resource.close().catch(() => undefined);
    }
    throw error;
  }
}
