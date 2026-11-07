#!/bin/bash
# Finder でダブルクリックすると「ターミナル」で停止処理を実行する
cd "$(dirname "$0")" || exit 1
./stop.sh
status=$?
echo
read -r -p "Enter キーでこのウィンドウを閉じます" _
exit $status
