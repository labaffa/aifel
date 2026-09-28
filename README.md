# aifel

Portale locale per consultare le informazioni di un progetto PNRR e le sue
procedure di gara a partire dal CUP. La ricerca legge snapshot JSON gia'
preparati; non avvia nuove elaborazioni.

## Ambiente

Dalla cartella dell'app:

```bash
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

L'app usa per default i dati nella cartella `dati/analisi/` del progetto IFEL,
due livelli sopra questa cartella. Se l'app e' collocata altrove, impostare
`AIFEL_WORKSPACE_ROOT` al percorso del progetto IFEL prima di eseguire i
comandi seguenti. Gli snapshot e i file sorgente non sono inclusi in questo
repository Git.

## Preparare i dati

```bash
uv run --python .venv/bin/python python build_data.py
```

Il comando combina l'export della pipeline, le procedure presenti nell'Excel
integrato e le evidenze CSV in un JSON per CUP sotto
`dati/analisi/cup_procurement_app/`. Per aggiornare un solo CUP usare
`--cup <CUP>`. Il campo `procedure_in_app` indica quali CIG sono presenti
nella tabella; gli altri restano nel dettaglio della pipeline. Se manca
l'Excel integrato, `procedures_available` e' falso. Rigenerare gli snapshot
dopo ogni modifica alle fonti.

## Avviare il portale

```bash
uv run --python .venv/bin/python python server.py
```

Aprire <http://127.0.0.1:5058>. I CUP disponibili sono quelli presenti negli
snapshot locali. I risultati sono divisi nei tab `Panoramica` e
`Procedure e CIG`. Le intestazioni della tabella ordinano le righe; cliccando
su un CIG si apre il dettaglio con fonti ed evidenze.
