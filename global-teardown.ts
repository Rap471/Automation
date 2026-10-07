import { mergePartials } from "./src/reporting/parallelReports";

export default async function globalTeardown(): Promise<void> {
  await mergePartials();
}
