#!/bin/sh
# Runs one recorded case, then lists the files left in the case's folder on stderr:
# replay compares the files a case writes, but not the ones it deletes ("stop ponytail" removes the flag).
"$@"
status=$?
find . -type f ! -path './.git/*' | LC_ALL=C sort >&2
exit $status
