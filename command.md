#### 


```



bun install
./packages/opencode/script/build.ts

docker build \
  -f packages/opencode/Dockerfile \
  -t opencode-local-11 \
  packages/opencode

```


```
docker run --rm -it \
  -p 4033:4033 \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -v /all-workspaces:/all-workspaces \
  opencode-local web --hostname 0.0.0.0 --port 4033



```



```

docker run --rm -it \
--user 1001:0 \
  -p 4033:4033 \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -v /all-workspaces:/all-workspaces \
  opencode-local web --hostname 0.0.0.0 --port 4033

```







```
docker run --rm -it \
  -p 4033:4033 \
  -e OPENCODE_SERVER_PASSWORD="change-me" \
  -v /all-workspaces:/all-workspaces \
  opencode-local web --hostname 0.0.0.0 --port 4033

```



```
docker run --rm -it --user 1001:0   -p 4033:4033   -e OPENCODE_SERVER_PASSWORD="change-me"   -v /all-workspaces:/all-workspaces -v  /all-workspaces:/.local -v /.cache:/.cache -v  /.config:/.config   opencode-local-1 web --hostname 0.0.0.0 --port 4033


```


```

docker run --rm -it --user 1001:0   -p 3001:3000   -e OPENCODE_SERVER_PASSWORD="change-me"   -v /all-workspaces:/all-workspaces -v /home/pragyan/opencode-convo:/.local -v /.cache:/.cache -v  /.config:/.config   opencode-local-4

```



```
docker run --rm -it --user 1001:0   -p 3001:3000   -e OPENCODE_SERVER_PASSWORD="change-me"   -v /home/pragyan/opencode-test/all-workspaces:/all-workspaces -v /home/pragyan/opencode-test/.local:/.local -v /home/pragyan/opencode-test/.cache:/.cache -v  /home/pragyan/opencode-test/.config:/.config   opencode-local-11


```