#!/usr/bin/env node
import { hideBin } from "yargs/helpers";
import { executeCli } from "./executeCli.js";

process.exitCode = await executeCli(hideBin(process.argv));
