/** Stable machine-readable failures at the network boundary. */
export class NetworkError extends Error {
  readonly code: string;
  readonly paths: string[];

  constructor(code: string, message: string, paths: string[] = []) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.paths = [...paths];
  }
}
