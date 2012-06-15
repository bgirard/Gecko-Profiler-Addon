#!/bin/bash
ssh webadmin@varium.fantasytalesonline.com "cd tomcat/webapps/ROOT/cleopatra/Gecko-Profiler-Addon&& echo Pull \$PWD && git pull"
