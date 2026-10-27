#!/bin/sh
t=$1; n=$(basename $t)
r=$(TEST_SCRIPT=G:/costareen-erp/$t ERP_NODE_CWD=G:/costareen-erp/local/node ./local/pgenv/Scripts/python supabase/tests/erp_server_test.py 2>&1 | grep "failure(s)\|^FAIL\|Error" | tail -4 | tr '\n' ' ')
echo "$n: $r"
