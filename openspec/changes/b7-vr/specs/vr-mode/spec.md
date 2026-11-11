# Spec Delta

## Purpose

Permite ver y conducir el juego en un visor WebXR (Meta Quest) como módulo opcional, sin alterar el modo de escritorio ni el volante del celular.

## ADDED Requirements

### Requirement: Disponibilidad del modo VR
El host SHALL mostrar el botón "Entrar en VR" solo cuando el navegador soporte sesiones WebXR inmersivas (`immersive-vr`) y la página esté en contexto seguro. En cualquier otro caso el botón MUST NOT mostrarse y el juego SHALL funcionar exactamente como antes.

#### Scenario: Navegador de escritorio sin WebXR
- **WHEN** el juego se abre en un navegador sin soporte `immersive-vr`
- **THEN** no se muestra el botón "Entrar en VR" y el flujo de emparejamiento y conducción es idéntico al de antes

#### Scenario: Meta Quest por túnel HTTPS
- **WHEN** el juego se abre en el navegador del Meta Quest desde la URL HTTPS del túnel de cloudflared
- **THEN** se muestra el botón "Entrar en VR"

### Requirement: Sesión inmersiva
Al pulsar "Entrar en VR" el host SHALL solicitar una sesión `immersive-vr` con el gesto del usuario. Al salir de la sesión, el juego SHALL volver al render de escritorio sin recargar la página ni perder la sala del volante.

#### Scenario: Entrada y salida
- **WHEN** el usuario pulsa "Entrar en VR" y después sale de la sesión desde el visor
- **THEN** la sesión se inicia, la simulación continúa desde el estado previo y, al salir, el canvas de escritorio vuelve a mostrarse con la misma sala y el mismo volante conectado

### Requirement: Render estéreo con perfil VR
Dentro de la sesión el render SHALL ser estéreo con el perfil de calidad VR, que MUST NOT usar posproceso, MUST usar un escalado del framebuffer ≤ 1,0 y MUST usar sombras con mapa ≤ 1024. Los perfiles de escritorio SHALL permanecer sin cambios.

#### Scenario: Presupuesto en el visor
- **WHEN** el juego corre en una sesión VR en el Meta Quest
- **THEN** la sesión mantiene al menos 72 fps de media durante una vuelta y no más de 200 draw calls por fotograma contando ambos ojos y la pasada de sombras

#### Scenario: Perfil de escritorio intacto
- **WHEN** el juego se ejecuta en escritorio con calidad alta
- **THEN** los valores de `src/render/quality.ts` y el presupuesto de `render-performance` son los mismos que antes del cambio

### Requirement: Cámara de cabeza
La cámara de la sesión SHALL seguir la pose de la cámara elegida en el rig de escritorio, y la pose de la cabeza del jugador SHALL sumarse como desplazamiento local. El FOV dinámico no se aplica en VR.

#### Scenario: Cabeza en cámara de casco
- **WHEN** el jugador gira la cabeza dentro de la cámara de casco
- **THEN** la vista gira con la cabeza y la posición del coche sigue a la del rig

### Requirement: HUD en el espacio 3D
En VR el HUD SHALL mostrarse como un panel en el espacio 3D, anclado delante del jugador, con velocidad en km/h, marcha, número de vuelta, tiempo de la vuelta en curso, última y mejor vuelta. El panel MUST NOT ocupar la zona central de la visión.

#### Scenario: Lectura en el visor
- **WHEN** el jugador conduce en VR
- **THEN** el panel muestra los mismos valores que el HUD de escritorio con el formato `m:ss.mmm`, sin solapes, dentro del campo de visión inferior

### Requirement: Mandos como fuente de entrada
Los mandos WebXR SHALL poder conducir el coche como fuente de entrada alternativa al volante del celular y al teclado. El gatillo derecho SHALL acelerar, el gatillo izquierdo SHALL frenar, y el ángulo de roll del mando derecho SHALL dar la dirección con la misma rampa que el teclado. Mientras el volante del celular esté conectado, MUST tener prioridad sobre los mandos.

#### Scenario: Conducción con mandos
- **WHEN** el jugador sostiene el mando derecho girado 45° a la derecha y pulsa el gatillo derecho
- **THEN** el `DriverInput` recibe una dirección positiva con rampa y acelerador mayor que 0, sin saltos

#### Scenario: Prioridad del volante
- **WHEN** el volante del celular está conectado durante una sesión VR y el jugador mueve los mandos
- **THEN** la entrada aplicada es la del volante y los mandos no alteran el coche

### Requirement: Sin regresiones de simulación ni protocolo
El módulo VR MUST NOT modificar la simulación, el protocolo PC–celular, el relay del servidor ni el volante del celular, y los tests de física existentes SHALL seguir en verde.

#### Scenario: Tests tras el cambio
- **WHEN** se ejecuta `npx vitest run` tras implementar el módulo
- **THEN** todos los tests pasan sin cambios en sus expectativas
