# Algorithms Cheat-Sheet

A dense, single-file reference of classic algorithms. Each section pairs a short
explanation, its complexity, and a complete, runnable implementation — sized so
the page-break safety is obvious: no algorithm is ever cut in half.

[[toc]]

## Binary Search

Find a target in a sorted array by repeatedly halving the search interval.
Time $O(\log n)$, space $O(1)$. Requires the input to be sorted.

```python
def binary_search(arr: list[int], target: int) -> int:
    """Return the index of target, or -1 if absent."""
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

## Quicksort

Divide-and-conquer sort: partition around a pivot, recurse on each side.
Average $O(n \log n)$, worst case $O(n^2)$ on already-sorted input with a poor
pivot. The Lomuto partition below is in-place.

```python
def quicksort(arr: list[int], lo: int = 0, hi: int | None = None) -> None:
    if hi is None:
        hi = len(arr) - 1
    if lo >= hi:
        return
    pivot = arr[hi]
    i = lo - 1
    for j in range(lo, hi):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]
    arr[i + 1], arr[hi] = arr[hi], arr[i + 1]
    p = i + 1
    quicksort(arr, lo, p - 1)
    quicksort(arr, p + 1, hi)
```

## Merge Sort

A stable $O(n \log n)$ sort that splits, sorts halves, then merges. Uses $O(n)$
extra space. Preferred when stability matters or worst-case bounds are required.

```python
def merge_sort(arr: list[int]) -> list[int]:
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    merged, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i]); i += 1
        else:
            merged.append(right[j]); j += 1
    merged.extend(left[i:])
    merged.extend(right[j:])
    return merged
```

## Dijkstra's Shortest Path

Single-source shortest paths on a graph with non-negative edge weights. With a
binary heap the cost is $O\!\left( (V + E) \log V \right)$. The relaxation step
keeps the tentative distance $d[v] = \min(d[v],\, d[u] + w(u, v))$.

```python
import heapq


def dijkstra(graph: dict[int, list[tuple[int, int]]], src: int) -> dict[int, int]:
    """graph maps node -> list of (neighbor, weight). Returns node -> distance."""
    dist = {src: 0}
    pq: list[tuple[int, int]] = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, float("inf")):
            continue
        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist
```

## Breadth-First Search

Level-order graph traversal; finds shortest paths in *unweighted* graphs.
Time $O(V + E)$, space $O(V)$. Uses a FIFO queue and a visited set.

```python
from collections import deque


def bfs(graph: dict[int, list[int]], start: int) -> list[int]:
    visited = {start}
    order: list[int] = []
    queue = deque([start])
    while queue:
        node = queue.popleft()
        order.append(node)
        for nxt in graph.get(node, []):
            if nxt not in visited:
                visited.add(nxt)
                queue.append(nxt)
    return order
```

## Dynamic Programming: 0/1 Knapsack

Maximize value under a weight budget $W$ with each item used at most once. The
recurrence is

$$
\mathrm{dp}[i][w] = \max\bigl( \mathrm{dp}[i-1][w],\; \mathrm{dp}[i-1][w - w_i] + v_i \bigr),
$$

giving $O(nW)$ time and, with the rolling-array trick below, $O(W)$ space.

```python
def knapsack(weights: list[int], values: list[int], capacity: int) -> int:
    dp = [0] * (capacity + 1)
    for wt, val in zip(weights, values):
        for w in range(capacity, wt - 1, -1):
            dp[w] = max(dp[w], dp[w - wt] + val)
    return dp[capacity]
```

## Union-Find (Disjoint Set)

Near-constant-time union and find with path compression and union by rank;
amortized $O(\alpha(n))$ per operation, where $\alpha$ is the inverse Ackermann
function. Used in Kruskal's MST and connectivity queries.

```python
class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True
```

## Complexity Summary

| Algorithm        | Time (avg)        | Time (worst)   | Space      | Stable |
| ---------------- | ----------------- | -------------- | ---------- | ------ |
| Binary search    | $O(\log n)$       | $O(\log n)$    | $O(1)$     | —      |
| Quicksort        | $O(n \log n)$     | $O(n^2)$       | $O(\log n)$| No     |
| Merge sort       | $O(n \log n)$     | $O(n \log n)$  | $O(n)$     | Yes    |
| Dijkstra         | $O((V+E)\log V)$  | $O((V+E)\log V)$ | $O(V)$   | —      |
| BFS              | $O(V + E)$        | $O(V + E)$     | $O(V)$     | —      |
| 0/1 Knapsack     | $O(nW)$           | $O(nW)$        | $O(W)$     | —      |
| Union-Find       | $O(\alpha(n))$    | $O(\alpha(n))$ | $O(n)$     | —      |

::: tip Choosing a sort
Use merge sort when you need a stability guarantee or a hard $O(n \log n)$ bound;
use quicksort for raw average speed and in-place operation on data without
adversarial ordering.
:::
