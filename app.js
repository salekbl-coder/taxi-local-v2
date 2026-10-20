
  $('#gps').addEventListener('click', async () => {
    const out = $('#gps-status');
    const button = $('#gps');

    // Comprobar si el navegador permite obtener la ubicación.
    if (!navigator.geolocation) {
      out.textContent =
        'Tu navegador no permite obtener la ubicación. Escribe la dirección manualmente.';
      return;
    }

    // La geolocalización necesita HTTPS o un contexto seguro.
    if (!window.isSecureContext) {
      out.textContent =
        'Para obtener tu ubicación, abre Taxi Local mediante una conexión segura HTTPS.';
      return;
    }

    button.disabled = true;
    out.textContent =
      'Tu navegador solicitará permiso para acceder a tu ubicación. Acepta para continuar.';

    try {
      // Detectar si el permiso ya está bloqueado, cuando la API esté disponible.
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({
          name: 'geolocation'
        });

        if (permission.state === 'denied') {
          out.textContent =
            'El permiso está bloqueado. Abre los ajustes del navegador, permite la ubicación para Taxi Local y vuelve a intentarlo.';
          button.disabled = false;
          return;
        }
      }
    } catch (error) {
      // Si no se puede consultar el permiso, intentamos solicitar la ubicación.
    }

    // Esta llamada provoca la solicitud de permiso del navegador
    // cuando todavía no se ha concedido ni denegado.
    navigator.geolocation.getCurrentPosition(
      position => {
        coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        const pickup = $('#ride-form').elements.pickup;

        // Mostrar las coordenadas obtenidas sin inventar una dirección postal.
        pickup.value =
          `Ubicación GPS (${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)})`;

        out.textContent =
          'Ubicación obtenida. Las coordenadas se enviarán con tu solicitud y se compartirán con el conductor que la acepte.';

        button.disabled = false;
      },

      error => {
        coords = null;

        switch (error.code) {
          case error.PERMISSION_DENIED:
            out.textContent =
              'No has permitido el acceso a tu ubicación. Activa el permiso en los ajustes del navegador y vuelve a intentarlo.';
            break;

          case error.POSITION_UNAVAILABLE:
            out.textContent =
              'No se ha podido determinar tu posición. Comprueba que la ubicación esté activada en el dispositivo.';
            break;

          case error.TIMEOUT:
            out.textContent =
              'La búsqueda ha tardado demasiado. Inténtalo otra vez o escribe la dirección manualmente.';
            break;

          default:
            out.textContent =
              'No se pudo obtener la ubicación. Escribe la dirección manualmente.';
        }

        button.disabled = false;
      },

      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  });
