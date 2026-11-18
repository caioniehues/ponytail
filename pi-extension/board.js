// A second entry: pi's loader transforms the band's TypeScript only for an entry that imports it statically.
import { boardHtml, tasksFrom } from "../hooks/band/board.ts";
import { ledgerDir, ledgerFile, rowFor, stamp, taskKey, upsertCsv } from "../hooks/band/ledger.ts";
import { isTestCommand, testCounts, testsLabel } from "../hooks/band/metrics.ts";
import { registerBoard } from "./ledger.js";

export default (pi) => registerBoard(pi, { boardHtml, tasksFrom, isTestCommand, ledgerDir, ledgerFile, rowFor, stamp, taskKey, testCounts, testsLabel, upsertCsv });
