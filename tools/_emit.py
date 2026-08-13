"""Shared output helper.

Data files are ES modules (`export default {...}`) rather than .json so that the
browser and the jsc test runner can both `import` them directly. A static site
with no build step cannot fetch() from file://, and the tracker's test suites
already use .mjs fixtures for the same reason. One format, no duplication.

Python 3 stdlib only.
"""

import json
import os


def read_module(path):
    """Read back a data file written by write_module()."""
    with open(path) as fh:
        source = fh.read()
    start = source.index("export default ") + len("export default ")
    return json.loads(source[start:].rstrip().rstrip(";"))


def write_module(path, doc, header="", compact=False):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if compact:
        body = json.dumps(doc, separators=(",", ":"), sort_keys=True)
    else:
        body = json.dumps(doc, indent=1, sort_keys=True)
    with open(path, "w") as fh:
        if header:
            for line in header.strip().splitlines():
                fh.write(f"// {line}\n".rstrip() + "\n" if line else "//\n")
            fh.write("\n")
        fh.write("export default ")
        fh.write(body)
        fh.write(";\n")
