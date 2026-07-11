# Passi finali — registrazione MCP (specifici per questa sessione)

Io (sandbox) ho già pronto: repo, server.json valido, chiave di firma, CLI.
A te restano 3 scritture nei tuoi account loggati. Poi io lancio il publish.

## 1. Cloudflare — custom domain sul Worker
Aggiungi al Worker `radixia-blog-mcp` un custom domain:
    mcp.radixia.ai   →   route su /mcp
(così l'endpoint pubblico diventa https://mcp.radixia.ai/mcp)

## 2. Cloudflare DNS (zona radixia.ai) — record TXT di verifica namespace
Aggiungi sull'apex del dominio:
    Tipo:  TXT
    Nome:  radixia.ai   (root / "@")
    Valore: v=MCPv1; k=ed25519; p=gUIFEGC/cSyztvRwsSgU3cP2HySsYv3faDOyia8WnJk=

Questo prova che controlli il dominio, così posso pubblicare sotto il namespace ai.radixia.

## 3. Ghost key come secret (solo se ridispieghi dal repo pulito)
Il Worker LIVE funziona già (ha la chiave come var). Se ridispieghi da questo repo:
    wrangler secret put GHOST_CONTENT_KEY   # incolla la read-only Content API key
(altrimenti il repo pubblico non contiene la chiave, ed è corretto così)

## 4. GitHub — repo pubblico (opzionale ma consigliato)
Crea github.com/radixia/blog-mcp e carica il contenuto di questo pacchetto.
Serve a Glama per l'auto-indicizzazione.

---
## Poi tocca a me (sandbox)
Appena i punti 1 e 2 sono attivi, dimmelo: eseguo
    mcp-publisher login dns --domain radixia.ai --private-key <chiave-in-sandbox>
    mcp-publisher publish
e verifico che il server compaia nel registro ufficiale.
