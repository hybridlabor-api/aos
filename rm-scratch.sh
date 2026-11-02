rm -rf patch-*.js test-check*.js
git rm patch-*.js test-check*.js || true
git commit --amend --no-edit
