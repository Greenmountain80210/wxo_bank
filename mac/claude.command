#!/bin/bash
# Finder でダブルクリックすると「ターミナル」で Claude Code を起動する
cd "$(dirname "$0")" || exit 1
./claude.sh
status=$?
echo
read -r -p "Enter キーでこのウィンドウを閉じます" _
exit $status
