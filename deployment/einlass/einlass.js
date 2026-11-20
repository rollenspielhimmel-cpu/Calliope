// The gate's page: sends the password the way the browser's own prompt would have, as a basic
// authentication header, and reloads once Caddy has answered with the pass.
//
// **Why a script and not a plain form.** Caddy cannot read a form body, and the check has to stay
// in Caddy — see the gate in the Caddyfile. A request carrying `Authorization` is exactly what
// `basic_auth` already understands, so the password is checked by the same line, against the same
// hash, as before.
//
// **Why `/` and not the page somebody is on.** The pass is handed out on documents only, never on
// `/api/*` or `/assets/*`. `/` is always a document, so the answer always carries it; the reload
// then takes the person to where they were going.

const form = document.getElementById('einlass')
const field = document.getElementById('passwort')
const notice = document.getElementById('hinweis')
const button = form.querySelector('button')

// `btoa` takes Latin-1 only, so an umlaut in the password would throw. Basic authentication is
// bytes, and Caddy compares the UTF-8 bytes it decodes against the hash.
function basic(name, password) {
  let binary = ''
  for (const byte of new TextEncoder().encode(`${name}:${password}`)) {
    binary += String.fromCharCode(byte)
  }
  return `Basic ${btoa(binary)}`
}

function say(text) {
  notice.textContent = text
  notice.hidden = false
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  notice.hidden = true
  button.disabled = true

  try {
    const response = await fetch('/', {
      headers: { Authorization: basic(form.dataset.name ?? '', field.value) },
      credentials: 'same-origin',
      cache: 'no-store',
    })

    if (response.ok) {
      window.location.reload()
      return
    }

    if (response.status === 401) {
      say('Das Passwort stimmt nicht.')
      field.select()
    } else {
      say(`Der Server antwortet gerade nicht wie erwartet (${response.status}). Bitte versuch es gleich noch einmal.`)
    }
  } catch {
    say('Keine Verbindung zum Server. Bitte versuch es gleich noch einmal.')
  } finally {
    button.disabled = false
  }
})
