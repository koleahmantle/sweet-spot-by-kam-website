/* Ordering page: menu, basket, and Square payment.
   The basket only ever carries product ids and quantities — the server
   prices everything from the database, so a tampered cart changes nothing. */
(function () {
  'use strict'

  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  var API = isLocal ? 'http://localhost:3000' : 'https://dashboard.thesweetspotbykam.com'

  // Public by design: both are safe in page source.
  var SQUARE_APP_ID = 'sandbox-sq0idb-kbI1jXnQe2ssDWAmvFF0AA'
  var SQUARE_LOCATION_ID = 'L5KR03QHEFNC1'

  var products = []
  var cart = []
  var card = null

  var els = {
    menu: document.getElementById('menu'),
    lines: document.getElementById('cart-lines'),
    total: document.getElementById('cart-total'),
    amount: document.getElementById('total-amount'),
    checkout: document.getElementById('checkout'),
    closed: document.getElementById('closed'),
    layout: document.getElementById('layout'),
    pickup: document.getElementById('pickup_date'),
    alert: document.getElementById('checkout-alert'),
    pay: document.getElementById('pay'),
  }

  function money(value) {
    return '$' + value.toFixed(2)
  }

  function showAlert(message) {
    els.alert.textContent = message
    els.alert.hidden = false
    var nav = document.querySelector('nav')
    var offset = (nav ? nav.getBoundingClientRect().height : 0) + 16
    var y = els.alert.getBoundingClientRect().top + window.pageYOffset - offset
    window.scrollTo({ top: y < 0 ? 0 : y, behavior: 'smooth' })
  }

  function clearAlert() {
    els.alert.hidden = true
  }

  /* ---------------------------------------------------------------- menu */

  function renderMenu() {
    if (products.length === 0) {
      els.menu.innerHTML = '<p class="cart-empty">Nothing is on the menu right now. Please check back soon.</p>'
      return
    }

    els.menu.innerHTML = products
      .map(function (product, index) {
        var flavours = product.flavors && product.flavors.length
          ? '<select data-flavor="' + index + '" aria-label="Flavour for ' + esc(product.name) + '">' +
            product.flavors.map(function (f) {
              return '<option value="' + esc(f) + '">' + esc(f) + '</option>'
            }).join('') + '</select>'
          : ''

        var image = product.image_url
          ? '<div class="product-img"><img src="/' + esc(product.image_url) + '" alt="' + esc(product.name) + '" loading="lazy" /></div>'
          : ''

        return (
          '<article class="product">' + image +
          '<div class="product-body">' +
          '<h3>' + esc(product.name) + '</h3>' +
          '<p class="price">' + money(product.price) + ' per ' + esc(product.unit) + '</p>' +
          '<p class="desc">' + esc(product.description || '') + '</p>' +
          '<div class="controls">' + flavours +
          '<input type="number" min="' + product.min_quantity + '" value="' + product.min_quantity +
          '" step="1" data-qty="' + index + '" aria-label="Quantity of ' + esc(product.name) + '" />' +
          '<button type="button" class="add-btn" data-add="' + index + '">Add to basket</button>' +
          '</div></div></article>'
        )
      })
      .join('')
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    })
  }

  els.menu.addEventListener('click', function (event) {
    var button = event.target.closest('[data-add]')
    if (!button) return

    var index = Number(button.getAttribute('data-add'))
    var product = products[index]
    var qtyInput = els.menu.querySelector('[data-qty="' + index + '"]')
    var flavorSelect = els.menu.querySelector('[data-flavor="' + index + '"]')
    var quantity = Math.max(product.min_quantity, Math.floor(Number(qtyInput.value) || 0))
    var flavor = flavorSelect ? flavorSelect.value : null

    // Same product and flavour merges rather than making a second line.
    var existing = cart.filter(function (line) {
      return line.product_id === product.id && line.flavor === flavor
    })[0]

    if (existing) existing.quantity += quantity
    else cart.push({ product_id: product.id, quantity: quantity, flavor: flavor, product: product })

    renderCart()
  })

  /* ---------------------------------------------------------------- cart */

  function cartTotal() {
    return cart.reduce(function (sum, line) {
      return sum + line.product.price * line.quantity
    }, 0)
  }

  function renderCart() {
    if (cart.length === 0) {
      els.lines.innerHTML =
        '<p class="cart-empty">Nothing added yet. Pick something from the menu and it&rsquo;ll appear here.</p>'
      els.total.hidden = true
      els.checkout.hidden = true
      return
    }

    els.lines.innerHTML = cart
      .map(function (line, index) {
        return (
          '<div class="cart-line">' +
          '<div class="grow"><div class="name">' + esc(line.product.name) + '</div>' +
          '<div class="meta">' + line.quantity + ' × ' + esc(line.product.unit) +
          (line.flavor ? ' · ' + esc(line.flavor) : '') + '</div></div>' +
          '<div class="amount">' + money(line.product.price * line.quantity) + '</div>' +
          '<button type="button" class="remove" data-remove="' + index + '" aria-label="Remove ' +
          esc(line.product.name) + '">×</button></div>'
        )
      })
      .join('')

    els.amount.textContent = money(cartTotal())
    els.total.hidden = false
    els.checkout.hidden = false
  }

  els.lines.addEventListener('click', function (event) {
    var button = event.target.closest('[data-remove]')
    if (!button) return
    cart.splice(Number(button.getAttribute('data-remove')), 1)
    renderCart()
  })

  /* ------------------------------------------------------------- loading */

  function loadMenu() {
    return fetch(API + '/api/public/menu')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (!data.ordering_enabled) {
          els.closed.textContent =
            data.closed_message || 'Online ordering is paused right now. Please text 612-470-2966.'
          els.closed.hidden = false
          els.layout.hidden = true
          return
        }
        products = data.products || []
        renderMenu()
      })
      .catch(function () {
        els.menu.innerHTML =
          '<p class="cart-empty">We couldn&rsquo;t load the menu. Please refresh, or text 612-470-2966.</p>'
      })
  }

  function loadDates() {
    return fetch(API + '/api/public/availability')
      .then(function (r) { return r.json() })
      .then(function (data) {
        var dates = data.dates || []
        if (dates.length === 0) {
          els.pickup.innerHTML = '<option value="">No dates available right now</option>'
          return
        }
        els.pickup.innerHTML =
          '<option value="">Choose a date</option>' +
          dates.map(function (slot) {
            var d = new Date(slot.date + 'T00:00:00Z')
            var label = d.toLocaleDateString('en-US', {
              timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric',
            })
            return '<option value="' + slot.date + '">' + label + '</option>'
          }).join('')
      })
      .catch(function () {
        els.pickup.innerHTML = '<option value="">Could not load dates</option>'
      })
  }

  /* ------------------------------------------------------------- payment */

  function initSquare() {
    if (!window.Square) return
    window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID)
      .card()
      .then(function (instance) {
        card = instance
        return card.attach('#card-container')
      })
      .catch(function (error) {
        console.error('Square card failed to load', error)
        document.getElementById('card-container').innerHTML =
          '<p class="cart-empty">Card payment could not load. Please refresh, or text 612-470-2966.</p>'
      })
  }

  els.pay.addEventListener('click', function () {
    clearAlert()

    var name = document.getElementById('name').value.trim()
    var email = document.getElementById('email').value.trim()
    var pickup = els.pickup.value

    if (!pickup) return showAlert('Please choose a pickup date.')
    if (!name) return showAlert('Please enter your name.')
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
      return showAlert('Please enter a valid email address, like name@example.com.')
    }
    if (!card) return showAlert('Card payment is still loading. Please wait a moment.')
    if (cart.length === 0) return showAlert('Your basket is empty.')

    els.pay.disabled = true
    els.pay.textContent = 'Processing…'

    card.tokenize()
      .then(function (result) {
        if (result.status !== 'OK') {
          throw new Error(
            (result.errors && result.errors[0] && result.errors[0].message) ||
              'Please check your card details.',
          )
        }
        return fetch(API + '/api/public/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            source_id: result.token,
            name: name,
            email: email,
            phone: document.getElementById('phone').value.trim(),
            notes: document.getElementById('notes').value.trim(),
            pickup_date: pickup,
            items: cart.map(function (line) {
              return { product_id: line.product_id, quantity: line.quantity, flavor: line.flavor }
            }),
          }),
        })
      })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Your order could not be placed.')
          return data
        })
      })
      .then(function (data) {
        var query = data.receipt_url ? '?receipt=' + encodeURIComponent(data.receipt_url) : ''
        location.href = '/order/thank-you/' + query
      })
      .catch(function (error) {
        showAlert(error.message || 'Something went wrong. Please try again.')
        els.pay.disabled = false
        els.pay.textContent = 'Place order'
        // A used token cannot be retried, so give them a fresh card field.
        if (card) card.destroy().then(initSquare).catch(function () {})
      })
  })

  loadMenu().then(loadDates).then(initSquare)
})()
