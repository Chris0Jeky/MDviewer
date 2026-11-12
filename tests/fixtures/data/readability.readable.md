# readability\.json
JSON · 910 B · object with 19 keys

| Key | Value |
| --- | --- |
| after | true |
| description | Short description\. |
| list | \"a\, b\", \"c · d\", \"e\: f\", \"true\" |
| object | first: \"1\" · second: \"&#32;padded&#32;\" |
| emptyObject | \{\} |
| emptyList | \[\] |
| number | 1 |
| string | \"1\" |
| boolean | true |
| booleanString | \"true\" |
| nullString | \"null\" |
| createdAt | 1700000000 (2023\-11\-14 22\:13 UTC) |
| lastSeenTs | 1700000000000 (2023\-11\-14 22\:13 UTC) |
| retry\_at | 3 |
| future\_at | 4102444801 |

## nested

| Key | Value |
| --- | --- |
| child | leaf: 1 |

## run

```
first line
  second line

last line
```

## long

<span>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</span>

## deep

### a

#### b

- c

  | Key | Value |
  | --- | --- |
  | after | 3 |

  - nested

    | Key | Value |
    | --- | --- |
    | child | leaf: 2 |
