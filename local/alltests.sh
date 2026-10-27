#!/bin/sh
# every suite except golive (needs a sheet export); prints only failures; summary at the end
cd G:/costareen-erp
: > local/alltests-run.log
for t in $(cat local/suites.txt); do sh local/onetest.sh $t >> local/alltests-run.log 2>&1; done
grep -v " 0 failure(s) $" local/alltests-run.log > local/alltests-fail.log
echo "suites: $(wc -l < local/alltests-run.log)  failing: $(wc -l < local/alltests-fail.log)"
cat local/alltests-fail.log
