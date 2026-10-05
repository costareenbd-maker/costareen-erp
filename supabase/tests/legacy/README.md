# Legacy tests (not run)

`test_partnership.py` tested the first partnership code, which ran inside the database
(`receive_stock`, `pool_receive_stock`, `create_invoice`). Those functions were dropped in
`063_drop_legacy.sql` (Stage 1e): the Edge Function does that work now, and the
`*_test.mjs` suites in the folder above test it. Kept only as history; it will not pass.
