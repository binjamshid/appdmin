FROM denoland/deno:2.5.1 AS cache
WORKDIR /app
COPY deno.json deno.lock ./
COPY src ./src
COPY adapters ./adapters
RUN deno cache src/cli.ts src/main.ts adapters/*/main.ts

FROM denoland/deno:2.5.1
WORKDIR /app
ENV DENO_DIR=/var/lib/appdmin/deno-cache APPDMIN_HOST=0.0.0.0 APPDMIN_PORT=8787
COPY --from=cache /deno-dir /deno-dir
COPY --from=cache /app /app
COPY migrations ./migrations
COPY deploy/container-entrypoint.sh /usr/local/bin/appdmin-entrypoint
RUN mkdir -p /var/lib/appdmin/deno-cache && \
    cp -R /deno-dir/. /var/lib/appdmin/deno-cache/ && \
    chown -R deno:deno /var/lib/appdmin && \
    chmod 0755 /usr/local/bin/appdmin-entrypoint && \
    printf '#!/bin/sh\nexec deno run --allow-env --allow-net --allow-read --allow-write --allow-run --allow-sys /app/src/cli.ts "$@"\n' > /usr/local/bin/appdmin && \
    chmod 0755 /usr/local/bin/appdmin
USER deno
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 CMD deno eval 'const r=await fetch("http://127.0.0.1:8787/health");if(!r.ok)Deno.exit(1)'
ENTRYPOINT ["/usr/local/bin/appdmin-entrypoint"]
CMD ["serve"]
