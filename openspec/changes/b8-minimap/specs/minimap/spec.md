# Spec Delta

## Purpose
Minimapa de anticipación en el HUD del PC: muestra la posición del coche y la forma de la pista inmediatamente por delante, para ver la siguiente curva con tiempo.

## ADDED Requirements

### Requirement: Recorte local de pista centrado en el coche
El minimapa SHALL mostrar solo un tramo de la línea central de la pista: 350 m por delante del coche y 60 m por detrás, muestreado cada 5 m, proyectado en el sistema del coche (adelante = arriba, derecha = derecha). El coche SHALL representarse como un punto fijo y el mapa SHALL rotar con el rumbo del coche. En pistas cerradas el tramo SHALL continuar sin saltos al cruzar la meta (s = 0).

#### Scenario: Recta alineada
- **WHEN** el coche está en una recta con el rumbo igual al de la pista
- **THEN** todos los puntos por delante tienen x = 0 ± 0,05 m y su y crece de 5 m a 350 m ± 5 m

#### Scenario: Rumbo desalineado
- **WHEN** el coche está en una recta con el rumbo girado 30° a la izquierda de la pista
- **THEN** el primer punto por delante forma 30° ± 1° con la vertical del mapa, hacia la derecha

#### Scenario: Cruce de meta
- **WHEN** el coche está a 100 m del final de la vuelta en una pista cerrada
- **THEN** la distancia entre puntos consecutivos es ≤ 7,5 m en todo el recorte, sin saltos

### Requirement: Curvas visibles con anticipación
El minimapa SHALL reflejar el sentido de las curvas del recorte (izquierda hacia −x, derecha hacia +x) y SHALL marcar como curva fuerte cada punto con curvatura |k| ≥ 0,008 1/m (radio ≤ 125 m).

#### Scenario: Curva a izquierda
- **WHEN** a 150 m por delante empieza una curva de radio 100 m hacia la izquierda
- **THEN** los puntos a partir de ahí derivan a x < 0 y están marcados como curva fuerte

#### Scenario: Recta sin marcas
- **WHEN** el recorte es una recta
- **THEN** ningún punto está marcado como curva fuerte

### Requirement: Presentación en el HUD
El HUD SHALL dibujar el minimapa en un canvas circular a la derecha de la pantalla, sin solaparse con el panel de energía ni con el aviso central. El coche SHALL ir en el tercio inferior del círculo para dejar más espacio hacia delante. El tramo recorrido SHALL dibujarse con menor opacidad que el tramo por delante y las curvas fuertes con un color distinto al resto. El dibujo SHALL actualizarse a 30 Hz o más sin asignar memoria por fotograma y sin superar 0,5 ms de media por actualización.

#### Scenario: Sin solape
- **WHEN** la carrera está en curso a 1920×1080
- **THEN** el rectángulo del minimapa (`data-testid="hud-minimap"`) no se interseca con el del panel de energía ni con el del aviso central

#### Scenario: Seguimiento
- **WHEN** el coche avanza 1 s a velocidad constante
- **THEN** el punto del coche no cambia de posición en el canvas y el dibujo se actualiza al menos 30 veces

#### Scenario: Sin errores
- **WHEN** se completa una vuelta con el minimapa visible
- **THEN** la consola del navegador no registra errores

### Requirement: Minimapa en VR
En una sesión de VR el minimapa SHALL mostrarse en un plano fijo respecto a la cabeza, abajo a la derecha del campo de visión (simétrico al panel de VR), con el mismo contenido que en el PC y actualizado a 30 Hz o más, sin solaparse con el panel de VR.

#### Scenario: Posición en VR
- **WHEN** se entra en VR con `hudDistanceM = 1,2` y lado 0,22 m
- **THEN** el plano del minimapa está a x > 0, y < 0, z = −1,2 m de la cámara, y su caja no se interseca con la del panel de VR

#### Scenario: Refresco en VR
- **WHEN** el minimapa se redibuja 30 veces en 1 s en VR
- **THEN** la textura del plano se marca para subir 30 veces, y 0 veces si el minimapa no se redibuja
