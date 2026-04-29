#!/bin/bash

CMD="rsync -av"
SRC="app/"
DST="kawhi@binney:/srv/sites/s44/app/"

cd "$(dirname "${BASH_SOURCE[0]}")"

echo -e "\n## $CMD --dry-run $SRC $DST"
$CMD --dry-run $SRC $DST

if [ $? -eq 0 ]; then
  echo -e "\n## If file list looks correct, hit ENTER to deploy."
  read

  echo -e "## $CMD $SRC $DST"
  $CMD $SRC $DST

else
  echo -e "\n## ERROR: Something went wrong, aborting deploy."
fi
