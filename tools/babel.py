#!/usr/bin/env python
import os
import sys
import subprocess

in_file = sys.argv[1]
out_file = sys.argv[2]

SOURCE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

subprocess.check_call(
  [
    "node",
    SOURCE_ROOT + "/node_modules/.bin/babel",
    os.getcwd() + "/" + in_file,
    "-o",
    out_file.replace("../../electron/src/", "electron/src/"),
    "--source-maps",
    "inline",
    "--config-file",
    SOURCE_ROOT + "/.babelrc"
  ],
)