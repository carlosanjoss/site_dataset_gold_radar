# Backup do PostgreSQL

Antes de copiar o projeto para a máquina virtual, gere o arquivo:

```text
backups/radar_odio.dump
```

O arquivo é restaurado automaticamente somente na primeira criação do volume
PostgreSQL. Dumps não são incluídos no Git nem na imagem Docker porque contêm
os textos e as avaliações do projeto.
