# app\.toml
TOML · 672 B · object with 25 keys

| Key | Value |
| --- | --- |
| basic | hello&#9;world |
| literal | C\:\\invented\\path |
| decimal | 1\_000 |
| hex | 0x1F |
| octal | 0o755 |
| binary | 0b1010 |
| signed | \+12 |
| negative | \-42 |
| float | 1\.0 |
| exponent | \-1\_2\.5\_0e\+2 |
| infinite | inf |
| nan | \-nan |
| enabled | true |
| offset | 1979\-05\-27T07\:32\:00\-07\:00 |
| local | 1979\-05\-27 07\:32\:00\.123 |
| date | 1979\-05\-27 |
| time | 07\:32\:00 |
| owner | name: Invented Reader |
| key\.with\.dots | verbatim |
| ports | 8080, 8443 |
| point | x: 1 · y: 2 · label: origin |
| server | host: localhost · tls: false |

## multibasic

```
one two
three

```

## multiliteral

```
one
\two

```

## products

| name | price |
| --- | ---: |
| Pencil | 1\.25 |
| Paper | 2\.0 |
