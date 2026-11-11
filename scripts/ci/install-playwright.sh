#!/usr/bin/env bash
# Install Playwright browsers WITH their OS packages (the fonts and libraries the layout and
# pixel tests were tuned against), surviving an Ubuntu mirror outage (#230). Same package set;
# only the route to it changes: up to three attempts, and from the second attempt apt uses
# archive.ubuntu.com instead of the runner's azure.archive.ubuntu.com mirror.
# Usage: scripts/ci/install-playwright.sh chromium [firefox ...]
set -u

[ "$#" -gt 0 ] || { echo "usage: $0 <browser>..." >&2; exit 2; }
route="runner default mirror (azure.archive.ubuntu.com)"

# Fail a dead mirror fast instead of hanging until the job timeout.
echo 'Acquire::Retries "3"; Acquire::http::Timeout "20"; Acquire::https::Timeout "20";' \
  | sudo tee /etc/apt/apt.conf.d/80-ci-retries > /dev/null

for attempt in 1 2 3; do
  echo "::group::playwright install --with-deps $* (attempt $attempt, $route)"
  timeout --kill-after=15 240 npx playwright install --with-deps "$@"
  status=$?
  echo "::endgroup::"
  if [ "$status" -eq 0 ]; then
    echo "Playwright install succeeded on attempt $attempt via $route."
    exit 0
  fi
  echo "::warning::Playwright install attempt $attempt failed (exit $status) via $route."
  [ "$attempt" -eq 3 ] && break

  # A timed-out attempt can leave apt or dpkg holding the lock.
  sudo pkill -x apt-get || true
  sudo pkill -x dpkg || true
  sudo dpkg --configure -a || true

  if [ "$attempt" -eq 1 ]; then
    for file in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
      [ -f "$file" ] && sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' "$file"
    done
    route="archive.ubuntu.com"
    sudo apt-get update || true
  fi
  sleep $((attempt * 15))
done

echo "::error::Playwright install failed after 3 attempts; last route: $route. See #230."
exit 1
