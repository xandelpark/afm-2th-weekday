// 아이폰 듀오 삼각대 받침 — OpenSCAD 원본. 치수는 mm.
slot=6.0; wall=3.0; wallH=14.0; plate=5.0; half=82.3; long=117.8;
nut_af=11.2; nut_h=5.6; bolt=6.6;   // 1/4-20 육각너트 포켓

module v_cradle(theta=100) {
  r0=7; arm=78; hole_y=24;
  difference() {
    union() {
      for (sg=[-1,1]) rotate([0,0,-sg*theta/2]) {
        translate([-(slot+2*wall+14)/2, r0-5, 0]) cube([slot+2*wall+14, arm+10, plate]);
        for (s=[-1,1]) translate([s*(slot/2+wall/2)-wall/2, r0, plate]) cube([wall, arm, wallH]);
        translate([-(slot/2+wall), r0+arm, plate]) cube([slot+2*wall, 3, wallH]);
      }
      translate([-15, -9, 0]) cube([30, 2*hole_y+14+9, plate]);
      translate([-8, -9, 0]) cube([16, 6, plate+8]);
    }
    translate([0, hole_y, -1]) cylinder(d=bolt, h=plate+2, $fn=32);
    translate([0, hole_y, plate-nut_h]) cylinder(d=nut_af/cos(30), h=nut_h+1, $fn=6);
  }
}
module tent_cradle(theta=130) {
  d = 2*half*sin(theta/2); len=long+6;
  difference() {
    union() {
      translate([-len/2, -(d/2+slot+2*wall+5), 0]) cube([len, d+2*(slot+2*wall)+10, plate]);
      for (sg=[-1,1]) translate([0, sg*d/2, plate]) rotate([-sg*theta/2, 0, 0])
        for (s=[-1,1]) translate([-len/2, s*(slot/2+wall/2)-wall/2, -1]) cube([len, wall, wallH]);
    }
    translate([0,0,-1]) cylinder(d=bolt, h=plate+2, $fn=32);
    translate([0,0,plate-nut_h]) cylinder(d=nut_af/cos(30), h=nut_h+1, $fn=6);
  }
}
// 쓸 것 하나만 남길 것:
v_cradle(100);
// translate([0,150,0]) tent_cradle(130);
