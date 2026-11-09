#!/bin/sh
# every suite, one line each, into local/alltests-distill.log (only failures printed at the end)
cd G:/costareen-erp
: > local/alltests-distill.log
for t in supabase/tests/*_test.mjs; do sh local/onetest.sh $t >> local/alltests-distill.log 2>&1; done
echo DONE >> local/alltests-distill.log
grep -v " 0 failure(s) $" local/alltests-distill.log
