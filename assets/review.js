(function() {
  var basePath = window.__reviewBasePath;
  var popup = document.getElementById('comment-popup');
  var input = document.getElementById('comment-input');
  var list = document.getElementById('review-comment-list');
  var selectedText = '';
  var savedRange = null;

  function setHighlight(range) {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.set('comment-pending', new Highlight(range));
    }
  }

  function clearHighlight() {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete('comment-pending');
    }
    savedRange = null;
  }

  // Prevent popup mousedown from collapsing native selection
  popup.addEventListener('mousedown', function(e) { e.preventDefault(); });

  document.getElementById('content-body').addEventListener('mouseup', function() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    var text = sel.toString().trim();
    if (!text) return;
    selectedText = text;
    savedRange = sel.getRangeAt(0).cloneRange();
    var rect = savedRange.getBoundingClientRect();
    setHighlight(savedRange);
    popup.style.top = (window.scrollY + rect.bottom + 8) + 'px';
    popup.style.left = rect.left + 'px';
    popup.style.display = 'block';
    input.value = '';
    input.focus();
  });

  function cancelPopup() {
    popup.style.display = 'none';
    selectedText = '';
    clearHighlight();
  }

  document.getElementById('comment-cancel').addEventListener('click', cancelPopup);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && popup.style.display !== 'none') cancelPopup();
  });

  document.getElementById('comment-submit').addEventListener('click', function() {
    var comment = input.value.trim();
    if (!comment) return;
    fetch(basePath + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: comment, selected_text: selectedText || undefined })
    }).then(function(r) { return r.json(); }).then(function(c) {
      var li = document.createElement('li');
      li.className = 'review-comment-item';
      if (c.selected_text) {
        li.innerHTML = '<blockquote class="review-quote">' + c.selected_text.replace(/</g,'&lt;') + '</blockquote>';
      }
      var p = document.createElement('p');
      p.className = 'review-comment-text';
      p.textContent = c.comment;
      li.appendChild(p);
      var ts = document.createElement('p');
      ts.className = 'review-comment-ts';
      ts.textContent = new Date().toLocaleString();
      li.appendChild(ts);
      var empty = list.querySelector('.review-comment-empty');
      if (empty) empty.remove();
      list.appendChild(li);
      popup.style.display = 'none';
      selectedText = '';
      clearHighlight();
    });
  });

  document.getElementById('commit-btn').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Committing…';
    fetch(basePath + '/commit', { method: 'POST' })
      .then(function() {
        btn.textContent = 'Review committed ✓';
      })
      .catch(function() {
        btn.disabled = false;
        btn.textContent = '✓ Commit Review';
      });
  });
})();
