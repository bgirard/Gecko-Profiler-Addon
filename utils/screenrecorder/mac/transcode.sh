#!/bin/bash
ffmpeg -r 60 -i $1 -b 5000k -an -c:v libvpx -metadata STEREO_MODE=left_right -r 60 -y $2
