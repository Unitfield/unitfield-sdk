#!/usr/bin/env node
import { processEnvironment, run } from "./run.js";

process.exitCode = await run(process.argv.slice(2), processEnvironment());
