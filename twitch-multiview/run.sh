#!/bin/sh
# Maven なしで JDK（17 以上）だけでビルドして起動する
set -e
cd "$(dirname "$0")"
rm -rf out
mkdir -p out
javac -encoding UTF-8 -d out -sourcepath src/main/java src/main/java/twitchmultiview/Main.java
cp -R src/main/resources/. out/
exec java -cp out twitchmultiview.Main "$@"
