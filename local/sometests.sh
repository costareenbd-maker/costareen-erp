#!/bin/sh
cd G:/costareen-erp
: > local/sometests.log
for t in "$@"; do sh local/onetest.sh supabase/tests/${t}_test.mjs >> local/sometests.log 2>&1; done
grep -v " 0 failure(s) $" local/sometests.log; echo "ran $(wc -l < local/sometests.log)"
