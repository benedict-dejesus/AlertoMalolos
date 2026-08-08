/* AlertoMalolos - progressive enhancement only.
   With JavaScript switched off the board still renders, every post-it still
   links to its own page, and every source link still works. This file adds
   filtering, in-place detail, and local relative times. */
(function () {
  'use strict';

  var dataNode = document.getElementById('board-data');
  var board = null;
  if (dataNode) {
    try {
      board = JSON.parse(dataNode.textContent);
    } catch (error) {
      board = null;
    }
  }

  /* ------------------------------------------------------ relative times */
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

  function refreshTimes() {
    var status = document.querySelector('[data-last-checked]');
    if (status) {
      var iso = status.getAttribute('data-last-checked');
      var text = status.querySelector('.status__text');
      if (text) text.textContent = 'Checked ' + localTime(iso, false) + ' · ' + relative(iso);
    }
    var stamps = document.querySelectorAll('time[data-relative]');
    for (var i = 0; i < stamps.length; i += 1) {
      var value = stamps[i].getAttribute('data-relative');
      stamps[i].textContent = localTime(value, true);
      stamps[i].title = relative(value);
    }
  }

  /* ------------------------------------------------------------ filters */
  function setUpFilters() {
    var panel = document.querySelector('[data-filters]');
    var notes = document.querySelector('[data-notes]');
    if (!panel || !notes) return;
    panel.hidden = false;

    var counter = document.querySelector('[data-count]');
    var buttons = panel.querySelectorAll('.filter');

    panel.addEventListener('click', function (event) {
      var button = event.target.closest('.filter');
      if (!button) return;
      var wanted = button.getAttribute('data-filter');
      var shown = 0;

      var cards = notes.querySelectorAll('.note');
      for (var i = 0; i < cards.length; i += 1) {
        var match = wanted === 'all' || cards[i].getAttribute('data-category') === wanted;
        cards[i].hidden = !match;
        if (match) shown += 1;
      }
      for (var j = 0; j < buttons.length; j += 1) {
        var active = buttons[j] === button;
        buttons[j].classList.toggle('is-active', active);
        buttons[j].setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      if (counter) {
        counter.textContent =
          'Showing ' + shown + (shown === 1 ? ' announcement' : ' announcements') +
          (wanted === 'all' ? '. The board holds up to 20.' : ' in this category.');
      }
    });
  }

  /* ------------------------------------------------------ detail dialog */
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
    if (record.isUpdated) flags.appendChild(element('span', 'flag flag--updated', 'Updated since first posted'));
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
    var button = externalLink(record.announcementUrl, 'Read official announcement ↗');
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
        item.appendChild(externalLink(entry.url, (entry.sourceName || 'Official source') + ' ↗'));
        list.appendChild(item);
      });
      facts.appendChild(fact('Also published by', list));
    }
    wrap.appendChild(facts);

    var note = element(
      'p',
      'detail__note',
      'The original announcement is the authority. For anything that affects your safety, confirm the details with the official source before acting.'
    );
    wrap.appendChild(note);

    var full = element('p', 'detail__back');
    var page = element('a', null, 'Open this notice on its own page');
    page.href = 'a/' + encodeURIComponent(record.id) + '.html';
    full.appendChild(page);
    full.style.display = 'block';
    full.style.marginTop = '1rem';
    wrap.appendChild(full);

    return wrap;
  }

  function setUpDialog() {
    var dialog = document.getElementById('detail-dialog');
    var notes = document.querySelector('[data-notes]');
    if (!dialog || !notes || !board || typeof dialog.showModal !== 'function') return;

    var slot = dialog.querySelector('[data-dialog-content]');
    var index = {};
    (board.announcements || []).forEach(function (record) {
      index[record.id] = record;
    });

    notes.addEventListener('click', function (event) {
      if (event.target.closest('.note__official')) return; // let the source link win
      var card = event.target.closest('.note');
      if (!card) return;
      var record = index[card.getAttribute('data-id')];
      if (!record) return;
      event.preventDefault();
      slot.textContent = '';
      slot.appendChild(buildDetail(record));
      dialog.showModal();
    });

    dialog.addEventListener('click', function (event) {
      if (event.target.closest('[data-close-dialog]')) {
        dialog.close();
        return;
      }
      // clicking the backdrop closes it
      if (event.target === dialog) dialog.close();
    });
  }

  refreshTimes();
  setInterval(refreshTimes, 60000);
  setUpFilters();
  setUpDialog();
})();
