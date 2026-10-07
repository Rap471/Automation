import { openScratchReport, publishScratchReport } from "./src/scratch/scratchReport";

export default function globalTeardown(): void {
  const report = publishScratchReport();
  console.log(`Scratch HTML report: ${report}`);
  openScratchReport(report);
}
