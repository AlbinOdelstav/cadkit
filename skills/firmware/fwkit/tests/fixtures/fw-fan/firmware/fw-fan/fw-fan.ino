// Test sketch for fwkit: button steps the fan speed, LED shows it is on.
#include "pins.h"

uint8_t speedStep = 0;
const uint8_t SPEEDS[] = {0, 120, 190, 255};

void setup() {
  Serial.begin(SERIAL_BAUD);
  pinMode(PIN_DRIVER_AIN1, OUTPUT);
  pinMode(PIN_DRIVER_AIN2, OUTPUT);
  pinMode(PIN_BTN_A, INPUT_PULLUP);
  pinMode(PIN_LED_ANODE, OUTPUT);
  digitalWrite(PIN_DRIVER_AIN1, HIGH);
  digitalWrite(PIN_DRIVER_AIN2, LOW);
  Serial.println(F("fan ready"));
}

void loop() {
  static bool was = HIGH;
  bool now = digitalRead(PIN_BTN_A);
  if (was == HIGH && now == LOW) {
    speedStep = (speedStep + 1) % 4;
    analogWrite(PIN_DRIVER_PWMA, SPEEDS[speedStep]);
    analogWrite(PIN_LED_ANODE, speedStep ? 40 : 0);
    Serial.print(F("speed ")); Serial.println(speedStep);
    delay(30);
  }
  was = now;
}
