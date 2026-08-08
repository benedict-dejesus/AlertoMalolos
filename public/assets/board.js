/* AlertoMalolos - progressive enhancement only.
   With JavaScript switched off the alerts still render, every panel still
   links to its own page, and every source link still works. This file adds
   the entrance, the live cycle indicator, filtering and in-place detail.

   Every animation here is skipped when the reader has asked for reduced
   motion, and nothing is ever hidden waiting for a script to reveal it. */
(function () {
  'use strict';

  var reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var dataNode = document.getElementById('board-data');
  var board = null;
  if (dataNode) {
    try {
      board = JSON.parse(dataNode.textContent);
    } catch (error) {
      board = null;
    }
  }

  /* ------------------------------------------------------------- times */
  function relative(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    var months = Math.round(days / 30);
    return months + (months === 1 ? ' month ago' : ' months ago');
  }

  function localTime(iso, withDate) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    try {
      return date.toLocaleString(undefined, {
        dateStyle: withDate ? 'medium' : undefined,
        timeStyle: 'short'
      });
    } catch (error) {
      return date.toLocaleString();
    }
  }

  /* --------------------------------------------------- the hourly cycle
     The fill is the share of the hour that has passed since the last check,
     and the label counts down to the next one. Both come from real times, so
     the indicator reports the cycle rather than performing it. */
  function updateCycle() {
    var cycle = document.querySelector('[data-cycle]');
    if (!cycle) return;

    var checkedAt = new Date(cycle.getAttribute('data-last-checked')).getTime();
    if (isNaN(checkedAt)) return;
    var interval = (parseInt(cycle.getAttribute('data-interval'), 10) || 60) * 60000;

    var elapsed = Date.now() - checkedAt;
    var progress = Math.max(0.02, Math.min(1, elapsed / interval));

    var fill = cycle.querySelector('[data-cycle-fill]');
    if (fill) fill.style.setProperty('--progress', (progress * 100).toFixed(1) + '%');

    var checked = cycle.querySelector('[data-cycle-checked]');
    if (checked) checked.textContent = localTime(checkedAt, false) + ' · ' + relative(checkedAt);

    var next = cycle.querySelector('[data-cycle-next]');
    if (next) {
      var remaining = Math.round((interval - elapsed) / 60000);
      next.textContent =
        remaining > 1 ? 'in ' + remaining + ' min' : remaining === 1 ? 'in a minute' : 'due now';
    }
  }

  function refreshStamps() {
    var stamps = document.querySelectorAll('time[data-relative]');
    for (var i = 0; i < stamps.length; i += 1) {
      var value = stamps[i].getAttribute('data-relative');
      stamps[i].textContent = localTime(value, true);
      stamps[i].title = relative(value);
    }
  }

  /* ----------------------------------------------------------- entrance
     Panels above the fold come in as a short staggered rise. The rest are
     revealed as they are scrolled to, so a board of twenty does not animate
     twenty things at once. */
  /** Drop the entrance entirely and show every panel as it is. */
  function showEverything() {
    var list = document.querySelector('[data-alerts]');
    if (list) list.classList.add('is-static');
  }

  function setUpEntrance() {
    var list = document.querySelector('[data-alerts]');
    if (!list) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      showEverything();
      return;
    }

    // A page opened in a background tab has no animation clock, so the
    // entrance would hold the alerts at nothing until it is looked at.
    if (document.visibilityState !== 'visible') {
      showEverything();
      return;
    }

    // Last line of defence: whatever happens, the alerts are readable shortly
    // after load.
    setTimeout(function () {
      var first = document.querySelector('.alerts .alert');
      if (first && parseFloat(getComputedStyle(first).opacity) < 0.9) showEverything();
    }, 2500);

    var alerts = [].slice.call(document.querySelectorAll('.alerts .alert'));
    if (!alerts.length) return;

    var viewportHeight = window.innerHeight;
    var held = [];

    alerts.forEach(function (alert, index) {
      if (alert.getBoundingClientRect().top < viewportHeight) {
        // Already on screen: let the stylesheet's animation run, staggered.
        alert.style.setProperty('--i', Math.min(index, 8));
        return;
      }
      // Below the fold: hold it at the start of its animation until it is
      // scrolled to. Should anything below fail, the animation simply plays.
      alert.style.setProperty('--i', 0);
      alert.classList.add('is-waiting');
      held.push(alert);
    });

    if (!held.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('is-waiting');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    held.forEach(function (alert) {
      observer.observe(alert);
    });

    // A held panel must never be stuck hidden. If the observer has not fired
    // for something after ten seconds, release it.
    setTimeout(function () {
      held.forEach(function (alert) {
        alert.classList.remove('is-waiting');
      });
    }, 10000);
  }

  /* ------------------------------------------------------------ filters */
  function setUpFilters() {
    var panel = document.querySelector('[data-filters]');
    var list = document.querySelector('[data-alerts]');
    if (!panel || !list) return;
    panel.hidden = false;

    var counter = document.querySelector('[data-count]');
    var buttons = panel.querySelectorAll('.filter');

    panel.addEventListener('click', function (event) {
      var button = event.target.closest('.filter');
      if (!button) return;

      var wanted = button.getAttribute('data-filter');
      var alerts = [].slice.call(list.querySelectorAll('.alert'));
      var shown = 0;

      alerts.forEach(function (alert) {
        var match = wanted === 'all' || alert.getAttribute('data-category') === wanted;
        alert.hidden = !match;
        if (!match) return;
        // Re-stagger what is left so the change reads as a change.
        alert.classList.remove('is-waiting');
        alert.style.setProperty('--i', Math.min(shown, 8));
        if (!reduceMotion) {
          alert.style.animation = 'none';
          void alert.offsetWidth; // restart it
          alert.style.animation = '';
        }
        shown += 1;
      });

      for (var i = 0; i < buttons.length; i += 1) {
        var active = buttons[i] === button;
        buttons[i].classList.toggle('is-active', active);
        buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      }

      if (counter) {
        counter.innerHTML = '';
        var number = document.createElement('span');
        number.className = 'alerts__count-n';
        number.textContent = String(shown);
        counter.appendChild(number);
        counter.appendChild(
          document.createTextNode(shown === 1 ? ' active announcement' : ' active announcements')
        );
      }
    });
  }

  /* ------------------------------------------------------- detail sheet */
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fact(term, definition) {
    var row = element('div', 'detail__row');
    row.appendChild(element('dt', null, term));
    var dd = element('dd');
    if (typeof definition === 'string') dd.textContent = definition;
    else dd.appendChild(definition);
    row.appendChild(dd);
    return row;
  }

  function externalLink(href, label) {
    var link = element('a', null, label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function categoryLabel(id) {
    var labels = {
      emergency: 'Emergency',
      weather: 'Weather',
      suspension: 'Class & work suspension',
      roads: 'Roads & traffic',
      utilities: 'Water & power',
      health: 'Health',
      services: 'Government services'
    };
    return labels[id] || 'Public notice';
  }

  function buildDetail(record) {
    var wrap = document.createDocumentFragment();

    if (record.isEmergency) wrap.appendChild(element('p', 'detail__banner', 'Emergency advisory'));

    var flags = element('p', 'detail__flags');
    flags.appendChild(element('span', 'chip chip--' + record.category, categoryLabel(record.category)));
    if (record.isUpdated) flags.appendChild(element('span', 'chip chip--updated', 'Updated since first posted'));
    wrap.appendChild(flags);

    var title = element('h2', 'detail__title', record.title);
    title.id = 'detail-dialog-title';
    wrap.appendChild(title);

    if (record.snippet) {
      var quote = element('blockquote', 'detail__snippet');
      quote.appendChild(element('p', null, record.snippet));
      quote.appendChild(element('cite', null, 'From the announcement published by ' + record.sourceName));
      wrap.appendChild(quote);
    }

    if (record.isTranscribed) {
      wrap.appendChild(
        element(
          'p',
          'detail__provenance',
          'This notice was recorded from the official post by hand, because that page cannot be read automatically. Open the original post for the exact wording.'
        )
      );
    }

    var cta = element('p', 'detail__cta');
    var button = externalLink(record.announcementUrl, 'Read official announcement →');
    button.className = 'button';
    cta.appendChild(button);
    wrap.appendChild(cta);

    var facts = element('dl', 'detail__facts');
    facts.appendChild(fact('Source', record.sourceName + (record.sourceType ? ' — ' + record.sourceType : '')));
    facts.appendChild(
      fact(
        'Published',
        record.publishedAtIsKnown
          ? localTime(record.publishedAt, true) + ' (' + relative(record.publishedAt) + ')'
          : 'Not stated by the source'
      )
    );
    facts.appendChild(
      fact(
        'Status on this board',
        record.isEmergency
          ? 'Emergency advisory'
          : record.isPriority
            ? 'Priority notice (' + record.priorityRank + ' of 3)'
            : record.isNew
              ? 'Recently posted'
              : 'Active'
      )
    );
    facts.appendChild(fact('First posted here', localTime(record.firstSeenAt, true)));

    var also = (record.alsoReportedBy || []).filter(function (entry) {
      return entry && entry.url;
    });
    if (also.length) {
      var list = element('ul', 'detail__sources');
      also.forEach(function (entry) {
        var item = element('li');
        item.appendChild(externalLink(entry.url, (entry.sourceName || 'Official source') + ' →'));
        list.appendChild(item);
      });
      facts.appendChild(fact('Also published by', list));
    }
    wrap.appendChild(facts);

    wrap.appendChild(
      element(
        'p',
        'detail__note',
        'The original announcement is the authority. For anything that affects your safety, confirm the details with the official source before acting.'
      )
    );

    var own = element('p', 'detail__back detail__back--own');
    var page = element('a', null, 'Open this notice on its own page');
    page.href = 'a/' + encodeURIComponent(record.id) + '.html';
    own.appendChild(page);
    own.style.display = 'block';
    own.style.marginTop = '1.25rem';
    wrap.appendChild(own);

    return wrap;
  }

  function setUpSheet() {
    var sheet = document.getElementById('detail-dialog');
    var list = document.querySelector('[data-alerts]');
    if (!sheet || !list || !board || typeof sheet.showModal !== 'function') return;

    var slot = sheet.querySelector('[data-dialog-content]');
    var index = {};
    (board.announcements || []).forEach(function (record) {
      index[record.id] = record;
    });

    list.addEventListener('click', function (event) {
      if (event.target.closest('.alert__official')) return; // the source link wins
      var panel = event.target.closest('.alert');
      if (!panel) return;
      var record = index[panel.getAttribute('data-id')];
      if (!record) return;

      event.preventDefault();
      slot.textContent = '';
      slot.appendChild(buildDetail(record));
      sheet.className = 'sheet' + (record.category ? ' detail--' + record.category : '');
      sheet.showModal();
    });

    sheet.addEventListener('click', function (event) {
      if (event.target.closest('[data-close-dialog]') || event.target === sheet) sheet.close();
    });
  }

  /* -------------------------------------------------------------- start */
  updateCycle();
  refreshStamps();
  setInterval(updateCycle, 30000);
  setInterval(refreshStamps, 60000);
  setUpEntrance();
  setUpFilters();
  setUpSheet();
})();
